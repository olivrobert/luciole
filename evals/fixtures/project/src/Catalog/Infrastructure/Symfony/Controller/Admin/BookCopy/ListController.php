<?php

declare(strict_types=1);

namespace Catalog\Infrastructure\Symfony\Controller\Admin\BookCopy;

use Catalog\Application\Message\Query\ListBookCopies\ListBookCopies;
use Catalog\Infrastructure\Symfony\Form\BookCopy\BookCopyFilterType;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\HandledStamp;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/book-copies', name: 'book_copy_list', methods: [Request::METHOD_GET])]
#[IsGranted('ROLE_ADMIN')]
final class ListController extends AbstractController
{
    public function __construct(
        private readonly MessageBusInterface $queryBus,
    ) {
    }

    public function __invoke(Request $request): Response
    {
        $filter = $this->createForm(BookCopyFilterType::class, null, ['method' => 'GET']);
        $filter->handleRequest($request);

        $criteria = $filter->isSubmitted() && $filter->isValid() ? $filter->getData() : [];

        $page = $this->queryBus
            ->dispatch(new ListBookCopies($criteria, $request->query->getInt('page', 1)))
            ->last(HandledStamp::class)
            ?->getResult();

        return $this->render('admin/catalog/book_copy/list.html.twig', [
            'filter' => $filter,
            'page' => $page,
        ]);
    }
}
