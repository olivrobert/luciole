<?php

declare(strict_types=1);

namespace Catalog\Infrastructure\Symfony\Controller\App\Book;

use Catalog\Application\Message\Command\Book\EditBook\EditBook;
use Catalog\Domain\Model\Book;
use Catalog\Infrastructure\Symfony\Form\Book\BookDto;
use Catalog\Infrastructure\Symfony\Form\Book\BookType;
use Catalog\Infrastructure\Symfony\Voter\BookVoter;
use SharedKernel\Domain\Model\TranslatableText;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Translation\TranslatorInterface;

#[Route('/{id}/edit', name: 'book_edit', methods: [Request::METHOD_GET, Request::METHOD_POST], requirements: ['id' => '\d+'])]
final class EditController extends AbstractController
{
    public function __construct(
        private readonly MessageBusInterface $commandBus,
        private readonly TranslatorInterface $translator,
    ) {
    }

    public function __invoke(Request $request, Book $book): Response
    {
        $this->denyAccessUnlessGranted(BookVoter::EDIT, $book);

        $dto = BookDto::fromEntity($book);
        $form = $this->createForm(BookType::class, $dto);
        $form->handleRequest($request);

        if ($form->isSubmitted() && $form->isValid()) {
            $this->commandBus->dispatch(new EditBook(
                book: $book,
                title: new TranslatableText($dto->titleFr, $dto->titleEn),
                summary: new TranslatableText($dto->summaryFr, $dto->summaryEn),
                genre: $dto->getLeafGenre(),
                authors: $dto->authors,
                isbn: $dto->isbn,
            ));

            $this->addFlash('success', $this->translator->trans('book.flash.edit_success', domain: 'catalog'));

            return $this->redirectToRoute('app_catalog_book_list');
        }

        return $this->render('app/catalog/book/edit.html.twig', [
            'form' => $form,
            'book' => $book,
        ]);
    }
}
