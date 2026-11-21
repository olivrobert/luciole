<?php

declare(strict_types=1);

namespace Library\Infrastructure\Symfony\Controller\Public\Registration;

use Library\Application\Message\Command\Registration\RegisterLibrary;
use Library\Domain\Exception\EmailAlreadyExistsException;
use Library\Infrastructure\Symfony\Form\Registration\RegistrationDto;
use Library\Infrastructure\Symfony\Form\Registration\RegistrationType;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\Exception\HandlerFailedException;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Translation\TranslatorInterface;

#[Route('', name: 'registration', methods: [Request::METHOD_GET, Request::METHOD_POST])]
final class RegistrationController extends AbstractController
{
    public function __invoke(
        Request $request,
        MessageBusInterface $bus,
        TranslatorInterface $translator,
    ): Response {
        $dto = new RegistrationDto();
        $form = $this->createForm(RegistrationType::class, $dto);
        $form->handleRequest($request);

        if ($form->isSubmitted() && $form->isValid()) {
            $dto->assertValid();

            try {
                $bus->dispatch(new RegisterLibrary(
                    email: $dto->email,
                    passwordHash: $dto->passwordHash,
                    firstName: $dto->firstName,
                    lastName: $dto->lastName,
                    phone: $dto->phone,
                    companyName: $dto->companyName,
                    address: $dto->address,
                    city: $dto->city,
                    postalCode: $dto->postalCode,
                ));

                return $this->redirectToRoute('public_library_registration_confirmation');
            } catch (HandlerFailedException $e) {
                if ($e->getWrappedExceptions(EmailAlreadyExistsException::class)) {
                    $this->addFlash('error', $translator->trans('registration.email_already_registered', domain: 'library'));

                    return $this->redirectToRoute('public_library_registration');
                }

                throw $e;
            }
        }

        return $this->render('public/library/registration/registration.html.twig', [
            'form' => $form,
        ]);
    }
}
