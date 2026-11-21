<?php

declare(strict_types=1);

namespace Fonds\Infrastructure\Symfony\Controller\App\Ouvrage;

use Fonds\Application\Message\Command\Ouvrage\EditOuvrage\EditOuvrage;
use Fonds\Domain\Model\Ouvrage;
use Fonds\Infrastructure\Symfony\Form\Ouvrage\OuvrageDto;
use Fonds\Infrastructure\Symfony\Form\Ouvrage\OuvrageType;
use Fonds\Infrastructure\Symfony\Voter\OuvrageVoter;
use SharedKernel\Domain\Model\TranslatableText;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Translation\TranslatorInterface;

#[Route('/{id}/editer', name: 'ouvrage_edit', methods: [Request::METHOD_GET, Request::METHOD_POST], requirements: ['id' => '\d+'])]
final class EditController extends AbstractController
{
    public function __construct(
        private readonly MessageBusInterface $commandBus,
        private readonly TranslatorInterface $translator,
    ) {
    }

    public function __invoke(Request $request, Ouvrage $ouvrage): Response
    {
        $this->denyAccessUnlessGranted(OuvrageVoter::EDIT, $ouvrage);

        $dto = OuvrageDto::fromEntity($ouvrage);
        $form = $this->createForm(OuvrageType::class, $dto);
        $form->handleRequest($request);

        if ($form->isSubmitted() && $form->isValid()) {
            $this->commandBus->dispatch(new EditOuvrage(
                ouvrage: $ouvrage,
                titre: new TranslatableText($dto->titreFr, $dto->titreEn),
                resume: new TranslatableText($dto->resumeFr, $dto->resumeEn),
                genre: $dto->getLeafGenre(),
                auteurs: $dto->auteurs,
                isbn: $dto->isbn,
            ));

            $this->addFlash('success', $this->translator->trans('ouvrage.flash.edit_success', domain: 'fonds'));

            return $this->redirectToRoute('app_fonds_ouvrage_list');
        }

        return $this->render('app/fonds/ouvrage/edit.html.twig', [
            'form' => $form,
            'ouvrage' => $ouvrage,
        ]);
    }
}
